import { readFile } from "fs/promises";
import path from "path";
import FlowerMorph from "./FlowerMorph";

export default async function Home() {
  const [svgA, svgB] = await Promise.all([
    readFile(path.join(process.cwd(), "Flower-1.svg"), "utf-8"),
    readFile(path.join(process.cwd(), "Flower-2.svg"), "utf-8"),
  ]);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-white">
      <FlowerMorph svgA={svgA} svgB={svgB} className="w-[min(80vw,560px)]" />
    </div>
  );
}
