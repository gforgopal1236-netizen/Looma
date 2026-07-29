import { Converter } from "@/components/converter";

export default function Page() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--background))_0%,#ffffff_55%,hsl(var(--background))_100%)]">
      <section className="container flex min-h-screen items-center justify-center py-8">
        <Converter />
      </section>
    </main>
  );
}
