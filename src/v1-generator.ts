async function getSections(): Promise<string[]> {
    const response = await fetch("https://tornapi.tornplayground.eu/api/v1/sections");
    const { sections } = await response.json();
    return sections;
}

async function getErrorCodes(): Promise<{ code: number; message: string; description: string }[]> {
    const response = await fetch("https://tornapi.tornplayground.eu/api/v1/errors");
    const { errors } = await response.json();
    return errors;
}

async function generateErrorCodesEnum(): Promise<string> {
    const errors = await getErrorCodes();

    return [
        "export enum TornApiError {",
        ...errors.map(
            ({ code, message }) =>
                `${message
                    .toUpperCase()
                    .replaceAll(/[^\w\s]/g, "")
                    .split(" ")
                    .filter((t) => !["IS", "IN", "THE", "OF", "THIS", "IDENTITY", "PLEASE", "TRY", "DUE", "OWNER", "AGAIN"].includes(t))
                    .slice(0, 5)
                    .join("_")} = ${code},`,
        ),
        "}",
    ].join("\n");
}

interface Structure {
    id: string;
    name: string;
    type?: string;
    values?: string[];
    schema?: Record<string, any>;
}

interface Selection {
    name: string;
    description: string;
    access: string;
    schema: Record<string, any>;
    structures: Structure[];
}

function sanitizeTypeName(name: string): string {
    // Remove special characters and spaces, convert to PascalCase
    return name
        .replace(/[,&]/g, "") // Remove commas and ampersands
        .split(/[\s\-_]+/) // Split on spaces, hyphens, underscores
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
}

async function generateSectionTypes(section: string): Promise<string> {
    const url = `https://tornapi.tornplayground.eu/api/v1/schema/${section}`;
    const data = await fetch(url).then((r) => r.json());

    const sectionName = section.charAt(0).toUpperCase() + section.slice(1);
    const types: string[] = [];
    const generatedStructures = new Set<string>();

    // Process each selection
    for (const selection of data.selections as Selection[]) {
        const selectionName = selection.name.charAt(0).toUpperCase() + selection.name.slice(1);

        // Generate structure types first
        for (const structure of selection.structures) {
            const structTypeName = `${sectionName}V1${sanitizeTypeName(structure.name)}`;

            if (generatedStructures.has(structTypeName)) {
                continue;
            }
            generatedStructures.add(structTypeName);

            if (structure.values) {
                // Enum type
                const enumValues = structure.values.map((v) => `"${v}"`).join(" | ");
                types.push(`export type ${structTypeName} = ${enumValues};`);
                types.push(""); // Empty line after type
            } else if (structure.schema) {
                // Interface type
                const fields = generateFields(structure.schema, selection.structures, sectionName, generatedStructures);
                const interfaceLines = [`export interface ${structTypeName} {`, ...fields.map((f) => `    ${f}`), `}`];
                types.push(interfaceLines.join("\n"));
                types.push(""); // Empty line after interface
            }
        }

        // Generate response interface
        const responseTypeName = `${sectionName}V1${selectionName}Response`;
        const responseFields = generateFields(selection.schema, selection.structures, sectionName, generatedStructures);

        const responseLines = [`export interface ${responseTypeName} {`, ...responseFields.map((f) => `    ${f}`), `}`];
        types.push(responseLines.join("\n"));
        types.push(""); // Empty line after interface
    }

    return types.join("\n");
}

function generateFields(schema: Record<string, any>, structures: Structure[], sectionName: string, generatedStructures: Set<string>): string[] {
    const fields: string[] = [];
    const dynamicKeys: Array<{ name: string; schema: any }> = [];
    const staticFields: Array<{ name: string; schema: any }> = [];

    // First pass: separate dynamic keys from static fields
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        if (fieldName.startsWith("<") && fieldName.endsWith(">")) {
            dynamicKeys.push({ name: fieldName, schema: fieldSchema });
        } else {
            staticFields.push({ name: fieldName, schema: fieldSchema });
        }
    }

    // If there are multiple dynamic keys, create a single index signature with union type
    if (dynamicKeys.length > 1) {
        // Generate a union type of all possible value types
        const valueTypes = dynamicKeys.map(({ schema: fieldSchema }) => generateTypeString(fieldSchema, structures, sectionName, generatedStructures));
        // Deduplicate types
        const uniqueTypes = [...new Set(valueTypes)];
        const unionType = uniqueTypes.join(" | ");
        fields.push(`[key: string]: ${unionType};`);
        return fields;
    }

    // Process all fields normally
    for (const { name: fieldName, schema: fieldSchema } of [...staticFields, ...dynamicKeys]) {
        let key = fieldName;
        if (fieldName.startsWith("<") && fieldName.endsWith(">")) {
            key = `[${fieldName.slice(1, -1).replace(/[\s\-]+/g, "_")}: string]`;
        } else if (
            /^[0-9]/.test(fieldName) || // Starts with a number
            /[\s\-]/.test(fieldName) || // Contains spaces or hyphens
            fieldName.includes("-") // Contains hyphen
        ) {
            // Quote field names that need quoting
            key = `"${fieldName}"`;
        }

        const typeStr = generateTypeString(fieldSchema, structures, sectionName, generatedStructures);
        fields.push(`${key}: ${typeStr};`);
    }

    return fields;
}

function generateTypeString(fieldSchema: any, structures: Structure[], sectionName: string, generatedStructures: Set<string>): string {
    let baseType: string;

    // Handle direct type
    if (typeof fieldSchema.type === "string") {
        baseType = mapPrimitiveType(fieldSchema.type);
    }
    // Handle structure reference
    else if (fieldSchema.structure) {
        const structure = structures.find((s) => s.id === fieldSchema.structure.id);
        if (!structure) {
            baseType = "unknown";
        } else {
            const structTypeName = `${sectionName}V1${sanitizeTypeName(structure.name)}`;

            if (fieldSchema.structure.type === "enum" && structure.values) {
                baseType = structure.values.map((v) => `"${v}"`).join(" | ");
            } else if (fieldSchema.structure.type === "object") {
                // Always use type reference
                baseType = structTypeName;
            } else {
                baseType = structTypeName;
            }
        }
    }
    // Handle nested object without structure reference
    else if (typeof fieldSchema === "object" && !fieldSchema.type && !fieldSchema.structure) {
        // For nested objects, generate inline
        const nestedFields = Object.entries(fieldSchema).map(([key, val]) => {
            const nestedType = generateTypeString(val as any, structures, sectionName, generatedStructures);
            return `${key}: ${nestedType}`;
        });
        baseType = `{ ${nestedFields.join("; ")} }`;
    } else {
        baseType = "unknown";
    }

    // Handle nullable
    if (fieldSchema.nullable === true) {
        baseType = `(${baseType}) | null`;
    }

    // Handle array
    if (fieldSchema.array === true) {
        baseType = `(${baseType})[]`;
    }

    return baseType;
}

function mapPrimitiveType(type: string): string {
    const lowerType = type.toLowerCase();

    switch (lowerType) {
        case "array of strings":
            return "string[]";
        case "boolean":
            return "boolean";
        case "array of integers":
        case "array of epoch timestamp (in seconds)":
            return "number[]";
        case "epoch timestamp (in seconds)":
        case "integer":
        case "number (with floating point)":
        case "integer or number (with floating point)":
            return "number";
        case "numberboolean (0 for false, 1 for true)":
            return "0 | 1";
        case "1 or 1.25":
            return "1 | 1.25";
        case "1 or 1.5":
            return "1 | 1.5";
        case "1 or 2":
            return "1 | 2";
        case "string":
        case "date (yyyy-dd-mm hh:mm:ss)":
        case "date (yyyy-mm-dd hh:mm:ss)":
            return "string";
        case "integer + string":
            return "number | string";
        case "integer + (empty) string":
            return 'number | ""';
        case "key-value map":
            return "Record<string, any>";
        case "unknown, let us know what it looks like.":
        case "unknown":
            return "unknown";
        default:
            console.warn(`Unknown type: ${type}`);
            return "unknown";
    }
}

export async function generateV1Types() {
    const sections = await getSections();
    const errorEnum = await generateErrorCodesEnum();
    const sectionTypes = await Promise.all(sections.map(generateSectionTypes));

    return [
        "// Auto-generated TypeScript types for Torn API V1",
        "// Generated from: https://tornapi.tornplayground.eu/api/v1/",
        "",
        ...sectionTypes.map((types, index) => {
            const sectionName = sections[index];
            return `// ===== ${sectionName.toUpperCase()} SECTION =====\n\n${types}`;
        }),
        "",
        "// ===== ERROR CODES =====",
        "",
        errorEnum,
    ].join("\n");
}
