import { redirect } from 'next/navigation';

/** The dashboard is the product; the home page goes straight to it. */
export default function Home() {
  redirect('/dashboard');
}
