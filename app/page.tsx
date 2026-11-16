export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-display text-4xl font-bold text-primary">
        Trick or Trap
      </h1>
      <p className="max-w-prose text-center text-base text-text">
        Paste an online shop URL and Trick or Trap opens the page in a real
        browser, flags possible manipulative design patterns, and marks each one
        with a monster.
      </p>
    </main>
  );
}
