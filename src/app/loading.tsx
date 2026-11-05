export default function Loading() {
  return (
    <main role="status" aria-label="SafeCall 화면을 불러오는 중" className="mx-auto flex min-h-screen max-w-lg flex-col gap-5 p-8">
      <p className="font-semibold">SafeCall 화면을 불러오는 중…</p>
      <div className="h-10 w-2/3 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <div className="h-36 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <div className="h-20 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <span className="sr-only">잠시 후 화면이 표시됩니다.</span>
    </main>
  );
}
