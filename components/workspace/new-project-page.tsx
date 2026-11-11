'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { EditorAccessGate } from './editor-access-gate';
import { NewConversation } from './new-conversation';

function StartPage({ checkoutPending = false }: { checkoutPending?: boolean }) {
  const conversation = <NewConversation />;
  return <EditorAccessGate checkoutPending={checkoutPending} loading={conversation}>{conversation}</EditorAccessGate>;
}

/** Back from a completed Stripe checkout (?checkout=success). Read from the address in the browser, so the page itself is static. */
function StartPageFromAddress() {
  return <StartPage checkoutPending={useSearchParams().get('checkout') === 'success'} />;
}

/** The AI Editor's start page. It shows at once and stays while the plan is checked. */
export function NewProjectPage() {
  return <Suspense fallback={<StartPage />}><StartPageFromAddress /></Suspense>;
}
