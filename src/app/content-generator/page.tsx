import { redirect } from 'next/navigation';

// Redirect to static HTML content generator
export default function ContentGeneratorRedirect() {
  redirect('/content-generator/index.html');
}
