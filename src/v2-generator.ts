import { OpenAPIV3 } from "@scalar/openapi-types";
import fs from "node:fs/promises";
import { getOpenApiReader, getTypeScriptWriter, makeConverter } from "typeconv";
import * as prettier from "prettier";

export async function generateV2Types() {
    const specification: OpenAPIV3.Document = await fetch("https://www.torn.com/swagger/openapi.json").then((r) => r.json());

    await fs.writeFile("dist/openapi.json", JSON.stringify(specification, null, 2));

    const types = await writeTypes(specification);

    const allCode = await prettier.format(types, {
        parser: "typescript",
        tabWidth: 4,
    });

    return ["// Auto-generated TypeScript types for Torn API V2", "// Generated from: https://www.torn.com/swagger/openapi.json", "", allCode].join("\n");
}

async function writeTypes(specification: OpenAPIV3.Document): Promise<string> {
    const reader = getOpenApiReader();
    const writer = getTypeScriptWriter();
    const { convert } = makeConverter(reader, writer);

    const { data } = await convert({ data: JSON.stringify(specification) });

    return data.replaceAll("[key: string]: any;", "").replaceAll("& ({\n        \n    } | null)", "| null").replaceAll("export ", "");
}
