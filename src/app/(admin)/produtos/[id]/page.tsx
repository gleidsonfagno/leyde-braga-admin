import { notFound } from 'next/navigation';
import { idSchema } from '../../../../lib/validation';
import { ProductEditor } from '../../../../components/product-editor';
export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  return <ProductEditor id={id} />;
}
