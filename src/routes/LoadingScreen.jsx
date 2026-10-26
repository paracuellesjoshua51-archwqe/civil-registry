const NAV_ITEMS = 7;
const CARDS = 4;

const block = "animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700";

export default function LoadingScreen() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="flex min-h-screen flex-col bg-gray-100 dark:bg-gray-950"
    >
      <header className="h-52px bg-[#1e3a6e] dark:bg-[#14284d]" />

      <div className="flex flex-1">
        <aside className="hidden w-56 flex-col gap-2.5 border-r border-gray-200 p-3 dark:border-gray-800 md:flex">
          {Array.from({ length: NAV_ITEMS }, (_, i) => (
            <div key={i} className={`${block} h-8`} />
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-5 p-6">
          <div className={`${block} h-7 w-1/3`} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {Array.from({ length: CARDS }, (_, i) => (
              <div key={i} className={`${block} h-24`} />
            ))}
          </div>
          <div className={`${block} h-72`} />
        </main>
      </div>
    </div>
  );
}