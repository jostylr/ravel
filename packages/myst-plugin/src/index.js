const firstUnescapedPipe = (value) => {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    if (escaped) escaped = false;
    else if (value[index] === "\\") escaped = true;
    else if (value[index] === "|") return index;
  }
  return -1;
};

const splitNamePipeline = (value) => {
  const pipeIndex = firstUnescapedPipe(value);
  return {
    name: (pipeIndex === -1 ? value : value.slice(0, pipeIndex)).trim().replace(/\\\|/g, "|"),
    pipeline: pipeIndex === -1 ? null : value.slice(pipeIndex + 1).trim()
  };
};

const normalizeLabel = (label) => {
  if (typeof label !== "string" || !label.trim()) return {};
  const identifier = label
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/['‘’"“”]+/g, "")
    .trim()
    .toLowerCase();
  return { label, identifier };
};

const text = (value) => ({ type: "text", value });
const inlineCode = (value) => ({ type: "inlineCode", value });

const cloneNodes = (nodes) =>
  Array.isArray(nodes) ? structuredClone(nodes) : [];

const captionChildren = (data, name, pipeline) => {
  const children = cloneNodes(data.options?.caption);
  if (children.length === 0) children.push(text("Piece: " + name));
  if (pipeline && data.options?.["show-pipeline"] !== false) {
    children.push(text(" — "));
    children.push(inlineCode("| " + pipeline));
  }
  return children;
};

const tagsFrom = (value) => {
  if (typeof value !== "string") return [];
  const inner = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return inner.split(/[,\s]/).map((entry) => entry.trim()).filter(Boolean);
};

const hash = (value) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const report = (vfile, data, message) => {
  if (typeof vfile?.message === "function") {
    const result = vfile.message(message, data.node, "ravel:piece");
    if (result && typeof result === "object") result.fatal = true;
  }
};

const targetOptions = (data, node, baseClass = "ravel-piece") => {
  const target = normalizeLabel(data.options?.label);
  if (target.label) node.label = target.label;
  if (target.identifier) node.identifier = target.identifier;
  const classes = [baseClass];
  if (typeof data.options?.class === "string") {
    classes.push(...data.options.class.split(/\s+/).filter(Boolean));
  }
  node.class = [...new Set(classes)].join(" ");
  if (typeof data.options?.enumerated === "boolean") {
    node.enumerated = data.options.enumerated;
  }
  if (typeof data.options?.enumerator === "string" && data.options.enumerator) {
    node.enumerator = data.options.enumerator;
  }
  return node;
};

const ravelData = (name, pipeline, owner, options) => ({
  piece: name,
  pipeline,
  executionOwner: owner,
  ...(options?.run === true ? { run: true } : {}),
  ...(typeof options?.provider === "string" && options.provider
    ? { provider: options.provider }
    : {})
});

export const pieceDirective = {
  name: "ravel:piece",
  alias: ["piece"],
  doc: "Render a named Ravel code piece with a visible caption, stable label, and optional definition pipeline.",
  arg: {
    type: String,
    required: true,
    doc: "Piece name followed by an optional `| pipeline`."
  },
  options: {
    language: {
      type: String,
      doc: "Code language used for syntax highlighting or notebook execution."
    },
    caption: {
      type: "myst",
      doc: "Visible parsed caption. Defaults to `Piece: <name>`."
    },
    label: {
      type: String,
      alias: ["name"],
      doc: "Stable MyST label used for links and cross-references."
    },
    class: {
      type: String,
      doc: "Additional space-delimited CSS classes."
    },
    enumerated: {
      type: Boolean,
      alias: ["numbered"],
      doc: "Enable or disable numbering for the rendered piece."
    },
    enumerator: {
      type: String,
      alias: ["number"],
      doc: "Explicit piece number."
    },
    "show-pipeline": {
      type: Boolean,
      doc: "Show the definition pipeline beside the caption. Defaults to true."
    },
    cell: {
      type: Boolean,
      doc: "Map the piece to a MyST notebook code cell."
    },
    tags: {
      type: String,
      alias: ["tag"],
      doc: "Comma-separated notebook cell tags."
    },
    "execution-owner": {
      type: String,
      doc: "Select `myst` or `ravel` as the code-cell execution owner."
    },
    run: {
      type: Boolean,
      doc: "Retain Ravel live-execution intent; rendering performs no Ravel execution."
    },
    provider: {
      type: String,
      doc: "Retain the selected Ravel live provider for source compatibility."
    }
  },
  body: {
    type: String,
    required: true,
    doc: "Raw code body."
  },
  run(data, vfile) {
    const { name, pipeline } = splitNamePipeline(data.arg ?? "");
    if (!name) {
      report(vfile, data, "The {ravel:piece} directive requires a non-empty piece name.");
      return [];
    }
    const configuredOwner = data.options?.["execution-owner"];
    const owner = configuredOwner ?? (data.options?.cell ? "myst" : null);
    if (owner !== null && owner !== "myst" && owner !== "ravel") {
      report(vfile, data, "The {ravel:piece} execution-owner must be myst or ravel.");
    }

    const body = data.body ?? "";
    const language = typeof data.options?.language === "string"
      ? data.options.language
      : undefined;
    const caption = {
      type: "caption",
      children: [{
        type: "paragraph",
        children: captionChildren(data, name, pipeline)
      }]
    };
    const code = {
      type: "code",
      ...(language ? { lang: language } : {}),
      value: body
    };
    const metadata = ravelData(name, pipeline, owner, data.options);

    if (data.options?.cell && owner !== "ravel") {
      code.executable = true;
      const block = {
        type: "block",
        kind: "code",
        children: [
          code,
          {
            type: "outputs",
            id: "piece-" + hash([data.options?.label, name, body].join("\0")),
            children: []
          }
        ],
        data: {
          caption: caption.children,
          ravel: metadata
        }
      };
      const tags = tagsFrom(data.options?.tags);
      if (tags.length) block.data.tags = tags;
      return [targetOptions(data, block)];
    }

    const container = {
      type: "container",
      kind: "code",
      children: [code, caption],
      data: { ravel: metadata }
    };
    return [targetOptions(data, container)];
  }
};

export const ravelDirective = {
  name: "ravel",
  doc: "Render a Ravel graph-directive block without executing it.",
  options: {
    caption: {
      type: "myst",
      doc: "Visible parsed caption. Defaults to `Ravel directives`."
    },
    label: {
      type: String,
      alias: ["name"],
      doc: "Stable MyST label used for links and cross-references."
    },
    class: {
      type: String,
      doc: "Additional space-delimited CSS classes."
    },
    enumerated: {
      type: Boolean,
      alias: ["numbered"],
      doc: "Enable or disable numbering for the rendered directive block."
    },
    enumerator: {
      type: String,
      alias: ["number"],
      doc: "Explicit directive-block number."
    }
  },
  body: {
    type: String,
    required: true,
    doc: "Raw Ravel graph directives."
  },
  run(data) {
    const captionNodes = cloneNodes(data.options?.caption);
    if (captionNodes.length === 0) {
      captionNodes.push(text("Ravel directives"));
    }
    const container = {
      type: "container",
      kind: "code",
      children: [
        {
          type: "code",
          lang: "ravel",
          value: data.body ?? ""
        },
        {
          type: "caption",
          children: [{
            type: "paragraph",
            children: captionNodes
          }]
        }
      ],
      data: {
        ravel: { directiveBlock: true }
      }
    };
    return [targetOptions(data, container, "ravel-directives")];
  }
};

const plugin = {
  name: "Ravel",
  author: "James Taylor",
  license: "MIT",
  directives: [pieceDirective, ravelDirective]
};

export default plugin;
