"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Error message and stack may contain sensitive user data; only log an opaque digest.
    if (error.digest) console.warn("SafeCall page error reference:", error.digest);
  }, [error]);
  return (
    <main role="alert" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">화면을 표시할 수 없습니다</h1>
      <p>예상하지 못한 문제가 발생했습니다. 실제 송금이나 금융거래는 수행되지 않습니다.</p>
      <button type="button" onClick={reset} className="rounded-xl border p-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">화면 다시 시도</button>
    </main>
  );
}
