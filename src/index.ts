import fs from "node:fs/promises";
import typescript from "typescript";
import { generateV1Types } from "./v1-generator.js";
import { generateV2Types } from "./v2-generator.js";
import * as prettier from "prettier";

(async () => {
    await fs.mkdir("dist").catch(() => {});

    const typesV1 = await generateV1Types();
    const typesV2 = await generateV2Types();
    const allTypes = [typesV1, typesV2].join("\n");

    // const allCode = await prettier.format(allTypes, {
    //     parser: "typescript",
    //     tabWidth: 4,
    // });
    // await fs.writeFile("dist/index.ts", allCode);

    const compiledDeclarations = typescript.transpileDeclaration(allTypes, {}).outputText;
    await fs.writeFile("dist/index.d.ts", compiledDeclarations);
})();
