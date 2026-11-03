import { redirect } from 'next/navigation';

/** Inspo Motion (Sharingan) was retired; old share links land on the home page. */
export default function SharinganPage() {
  redirect('/');
}
