const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

type PathParamType = "text" | "uuid";

export function pathParamsSchema(params: Record<string, PathParamType>) {
  return {
    type: "object" as const,
    required: Object.keys(params),
    properties: Object.fromEntries(Object.entries(params).map(([name, type]) => [
      name,
      type === "uuid"
        ? { type: "string", pattern: uuidPattern }
        : { type: "string", minLength: 1 },
    ])),
  };
}
