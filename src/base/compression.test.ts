import assert from "node:assert";
import { buffer, text } from "node:stream/consumers";
import { describe, it } from "node:test";
import { CompressionMethod } from "../internal/field-types.js";
import { maxChunkSize } from "../internal/streams.js";
import { asyncIterable, base64, base64iterable } from "../testing/data.js";
import { defaultCompressors, defaultDecompressors } from "./compression.js";

describe("base/compression", () => {
  describe("defaultCompressors", () => {
    it("can compress a stream using DEFLATE", async () => {
      // https://hipsum.co/
      const hipsterIpsum = maxChunkSize(
        asyncIterable`
I'm baby 3 wolf moon crucifix bodega boys, iceland glossier asymmetrical kale 
chips VHS kitsch skateboard paleo cloud bread farm-to-table marfa. Occupy jean 
shorts helvetica swag dreamcatcher hell of bicycle rights narwhal taxidermy. 
Literally dreamcatcher pork belly fam, vinyl poke venmo tote bag farm-to-table 
freegan vice vaporware. Small batch tonx hot chicken iceland grailed. Tattooed 
narwhal echo park, forage dreamcatcher everyday carry offal cray meggings 
polaroid migas VHS roof party. Raw denim echo park bruh tilde adaptogen selfies 
chartreuse cupping 3 wolf moon.`,
        10,
      );

      const compressed = await buffer(
        defaultCompressors[CompressionMethod.Deflate](hipsterIpsum),
      );

      // manually determined
      assert.deepStrictEqual(
        compressed,
        base64`XZJBihwxDEX3dYq/y6anNrnEBAKBTMhetmVbKdsysqu6ffvQhDCZbCV4/6
      Gv7cunCkdu4TPuWiKqaoO300uUB5wGTgSna9wgngu1gFR0DGEDjVUrTxNPBQcVxuaz9IGfr284
      ZA6fMQ6a7JQsoFNhhS96BjhjCohk9WXqyyRXGJUs0o5v3p994RdTwzay2hzIXC6e4gnjTgnBmK
      qn6TPbc1egEU788oVhkvIcaGT3TAWTHhLY6tqxfZXJRqWsj4SudsDxcx6p3nBJWwVdD8bFrSqm
      Toaj9J/wFo05UcMlnnFRV7uT8Y63SqXAPfGY2h7IOuGz+IPb+xmNpHDY8YPmVOWA7a8z+6zoZM
      cNUY0Sf/Tli20FWvBktqAxUoE3WqickrQ0sHUtZCoBVRL9acRU45M6147vdEfgJvU9C87OjCkl
      MChQn5q4YXCJwuPZLNk0PgfDn71LS/++zP4b`,
      );
    });
  });

  describe("defaultDecompressors", () => {
    it("can decompress a stream using DEFLATE", async () => {
      const hipsterIpsum = `
Forage chicharrones sriracha hammock taiyaki shabby chic freegan tattooed tonx 
godard marxism intelligentsia williamsburg retro woke. Edison bulb same celiac 
truffaut cliche coloring book single-origin coffee godard glossier kickstarter 
shaman. Poke pickled messenger bag fanny pack pinterest. Kombucha sus migas, 
blog cardigan kitsch actually big mood salvia sriracha. Quinoa typewriter 
biodiesel shaman, hexagon kickstarter DIY cray slow-carb man braid mumblecore 
vice. Master cleanse chambray normcore, dreamcatcher drinking vinegar lyft sus 
tilde tofu sriracha.`;

      // manually determined
      const compressed = base64iterable`
VZFLjttADET3OkUdwONTJAMEQYBkmSWbTbWI/tAgW7Z1+0CeQYLsq4BXr5Z3cyoC3pQ3crchgXB14o2w
Ue/GFZP0oKqIjVI6XmGsLlJoYNKcZpIxbTyxFMvkGZ38qdGhY0prWmTMUMJDW1PqkXYvcJlueFiVK75m
DRtIe0sI6gKWpsRYpu/rSvsEN+VNwNbMdRQks4rQUZq8mWvRAbZ1FcEnQmkWoeKoyjUm+RTHEht1Glf8
tCq4KdcmGV0iZBRxJCpYaYwDN+KK28nvEvOK79bTfkqJPdC1UFywpGYFTJ71VFF1Bm8gnju1diBpQTfL
CGp3pb9er/i16zDCPG7ycH2BJbWsEtLwgXjBJk8qNv7j//LtN9jpQDR7vDF5QqeB5KQZfe+pCZsLlruy
XPGD4mxxExpxvkw9ne1h3s/cBdmFOtPkTRzZddRT7l2HFHK0Y52vwcvUlgXT1v3fjD8=`;

      const uncompressed = await text(
        defaultDecompressors[CompressionMethod.Deflate](
          maxChunkSize(compressed, 10),
        ),
      );

      assert.strictEqual(uncompressed, hipsterIpsum);
    });
  });
});
