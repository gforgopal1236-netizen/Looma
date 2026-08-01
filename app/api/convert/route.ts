export const runtime = "nodejs";

const CLOUDCONVERT_API = "https://api.cloudconvert.com/v2";
const CLOUDCONVERT_SYNC_API = "https://sync.api.cloudconvert.com/v2";

type CloudConvertTask = {
  id: string;
  name: string;
  operation: string;
  status: string;
  message?: string;
  result?: {
    form?: {
      url: string;
      parameters: Record<string, string | number>;
    };
    files?: Array<{
      filename: string;
      url: string;
    }>;
  };
};

type CloudConvertJob = {
  id: string;
  status: string;
  tasks: CloudConvertTask[];
};

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function safeBaseName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "converted";
}

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = process.env.CLOUDCONVERT_API_KEY;

    if (!apiKey) {
      return Response.json(
        { error: "CloudConvert API key is not configured." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const target = formData.get("target");

    if (!(file instanceof File)) {
      return Response.json({ error: "A file is required." }, { status: 400 });
    }

    if (target !== "pdf" && target !== "docx") {
      return Response.json(
        { error: "Target must be pdf or docx." },
        { status: 400 },
      );
    }

    const inputFormat = getExtension(file.name);

    const validConversion =
      (inputFormat === "docx" && target === "pdf") ||
      (inputFormat === "pdf" && target === "docx");

    if (!validConversion) {
      return Response.json(
        { error: "Only DOCX to PDF and PDF to DOCX are supported." },
        { status: 400 },
      );
    }

    const createResponse = await fetch(`${CLOUDCONVERT_API}/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tasks: {
          "import-file": {
            operation: "import/upload",
          },
          "convert-file": {
            operation: "convert",
            input: "import-file",
            input_format: inputFormat,
            output_format: target,
          },
          "export-file": {
            operation: "export/url",
            input: "convert-file",
          },
        },
      }),
    });

    if (!createResponse.ok) {
      const details = await createResponse.text();
      throw new Error(`Could not create conversion job: ${details}`);
    }

    const created = (await createResponse.json()) as {
      data: CloudConvertJob;
    };

    const importTask = created.data.tasks.find(
      (task) => task.operation === "import/upload",
    );

    const uploadForm = importTask?.result?.form;

    if (!uploadForm) {
      throw new Error("CloudConvert did not provide an upload form.");
    }

    const uploadData = new FormData();

    for (const [name, value] of Object.entries(uploadForm.parameters)) {
      uploadData.append(name, String(value));
    }

    uploadData.append("file", file, file.name);

    const uploadResponse = await fetch(uploadForm.url, {
      method: "POST",
      body: uploadData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`File upload failed: ${await uploadResponse.text()}`);
    }

    const finishedResponse = await fetch(
      `${CLOUDCONVERT_SYNC_API}/jobs/${created.data.id}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!finishedResponse.ok) {
      throw new Error(
        `Conversion did not finish: ${await finishedResponse.text()}`,
      );
    }

    const finished = (await finishedResponse.json()) as {
      data: CloudConvertJob;
    };

    if (finished.data.status !== "finished") {
      const failedTask = finished.data.tasks.find(
        (task) => task.status === "error",
      );

      throw new Error(
        failedTask?.message ?? "CloudConvert conversion failed.",
      );
    }

    const exportTask = finished.data.tasks.find(
      (task) => task.operation === "export/url",
    );

    const output = exportTask?.result?.files?.[0];

    if (!output?.url) {
      throw new Error("CloudConvert did not return an output file.");
    }

    const downloadResponse = await fetch(output.url);

    if (!downloadResponse.ok) {
      throw new Error("Could not download the converted file.");
    }

    const convertedFile = await downloadResponse.arrayBuffer();
    const outputName = `${safeBaseName(file.name)}.${target}`;

    return new Response(convertedFile, {
      headers: {
        "Content-Type":
          target === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${outputName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Conversion error:", error);

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Conversion failed.",
      },
      { status: 500 },
    );
  }
}