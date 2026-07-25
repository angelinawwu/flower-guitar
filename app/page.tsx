import { readFile } from "fs/promises";
import path from "path";
import FlowerMorph from "./FlowerMorph";

const readFlower = (name: string) =>
  readFile(path.join(process.cwd(), "public", "Flowers", `${name}.svg`), "utf-8");

export default async function Home() {
  const [flowerA1, flowerA2, flowerB1, flowerB2, flowerC1, flowerC2] =
    await Promise.all([
      readFlower("FlowerA-1"),
      readFlower("FlowerA-2"),
      readFlower("FlowerB-1"),
      readFlower("FlowerB-2"),
      readFlower("FlowerC-1"),
      readFlower("FlowerC-2"),
    ]);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-white">
      <div className="flex flex-row items-center justify-center gap-8">
        <FlowerMorph svgA={flowerA1} svgB={flowerA2} className="w-[min(25vw,320px)]" />
        <FlowerMorph svgA={flowerB1} svgB={flowerB2} className="w-[min(25vw,320px)]" />
        <FlowerMorph svgA={flowerC1} svgB={flowerC2} className="w-[min(25vw,320px)]" />
      </div>
    </div>
  );
}
