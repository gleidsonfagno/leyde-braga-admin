import 'dotenv/config';
import { createInterface, emitKeypressEvents, type Key } from 'node:readline';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { loginSchema, passwordSchema } from '../src/lib/validation';

class InputError extends Error {}

function readEmail(): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 0,
    });

    reader.once('SIGINT', () => reader.close());
    reader.once('close', () => reject(new InputError('Entrada cancelada.')));
    reader.once('error', () => {
      reject(new InputError('Não foi possível ler o email.'));
      reader.close();
    });
    reader.question('Email: ', (answer) => {
      resolve(answer.trim().toLowerCase());
      reader.close();
    });
  });
}

function readPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  const previousRawMode = input.isRaw;
  const wasFlowing = input.readableFlowing;

  return new Promise((resolve, reject) => {
    let password = '';

    function finish(error?: InputError) {
      input.removeListener('keypress', onKeypress);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onError);
      input.setRawMode(previousRawMode);
      if (wasFlowing !== true) input.pause();
      process.stdout.write('\n');
      if (error) {
        password = '';
        reject(error);
      } else {
        resolve(password);
        password = '';
      }
    }

    function onEnd() {
      finish(new InputError('Entrada cancelada.'));
    }

    function onError() {
      finish(new InputError('Não foi possível ler a senha.'));
    }

    function onKeypress(value: string | undefined, key: Key) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        finish(new InputError('Entrada cancelada.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.name === 'backspace') {
        password = Array.from(password).slice(0, -1).join('');
      } else if (!key.ctrl && !key.meta && value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
        password += value;
      }
    }

    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKeypress);
    input.once('end', onEnd);
    input.once('close', onEnd);
    input.once('error', onError);
    process.stdout.write(prompt);
    input.resume();
  });
}

async function main() {
  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new InputError('Execute em um terminal interativo (TTY), sem pipes ou redirecionamento.');
    }
    if (process.argv.length > 2) {
      throw new InputError('Não passe argumentos. Informe email e senha somente nos prompts.');
    }

    const email = await readEmail();
    if (!loginSchema.shape.email.safeParse(email).success) {
      throw new InputError('Informe um email válido, com no máximo 254 caracteres.');
    }

    const password = await readPassword('Senha (12 a 128 caracteres; entrada oculta): ');
    if (!passwordSchema.safeParse(password).success) {
      throw new InputError('A senha deve ter entre 12 e 128 caracteres.');
    }
    const confirmation = await readPassword('Confirme a senha (entrada oculta): ');
    if (password !== confirmation) {
      throw new InputError('As senhas não conferem.');
    }

    const credentials = loginSchema.safeParse({ email, password });
    if (!credentials.success) throw new InputError('Email ou senha inválidos.');

    await db.admin.create({
      data: {
        email: credentials.data.email,
        passwordHash: await hashPassword(credentials.data.password),
      },
    });
    console.log('Administrador criado com sucesso.');
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof InputError
    ? error.message
    : 'Não foi possível criar o administrador. Verifique a configuração, as migrations e se o email já está cadastrado.');
  process.exitCode = 1;
});
