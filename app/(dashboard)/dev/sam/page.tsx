import { notFound } from 'next/navigation';
import { SamMaskLab } from '@/components/editor/sam-mask-lab';

export default function SamLabPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <SamMaskLab/>;
}
