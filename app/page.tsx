import { readFile } from "fs/promises";
import path from "path";
import SongMaker from "./SongMaker";

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
    <SongMaker
      svgs={{
        A: { closed: flowerA1, open: flowerA2 },
        B: { closed: flowerB1, open: flowerB2 },
        C: { closed: flowerC1, open: flowerC2 },
      }}
    />
  );
}
