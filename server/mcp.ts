// Servidor MCP (stdio): las mismas herramientas del agente bróker para Claude Desktop, Claude Code
// u otro cliente MCP. Lee y escribe en la misma base de datos que la web.
//
//   claude mcp add broker -e DATABASE_URL=postgres://broker:broker@localhost:5433/broker -- node <ruta>/server/mcp.ts
//   (añade -e BROKER_USER=<id> para actuar como otro usuario)
//
// Con Docker (docker compose up db) usa DATABASE_URL. Sin DATABASE_URL abre la base de datos embebida
// (data/pglite), que solo admite un proceso: no lo arranques a la vez que `npm run dev`.
import "./env.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS, makeContext, runTool, type ToolName } from "./tools.ts";

const server = new McpServer({ name: "broker-ia", version: "0.2.0" });

for (const name of Object.keys(TOOLS) as ToolName[]) {
  const tool = TOOLS[name];
  server.registerTool(name, { description: tool.description, inputSchema: tool.schema.shape }, async (input: unknown) => {
    try {
      // el perfil se relee en cada llamada: puede haber cambiado desde la web
      const output = await runTool(name, input, await makeContext("mcp"));
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] };
    }
  });
}

await server.connect(new StdioServerTransport());
