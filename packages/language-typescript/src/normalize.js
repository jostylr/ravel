import { pathToFileURL } from "node:url";

export const rangeForSpan = (span) => span === undefined
  ? undefined
  : { start: span.start, end: span.start + span.length };

export const displayParts = (parts) =>
  typeof parts === "string"
    ? parts
    : Array.isArray(parts) ? parts.map((part) => part.text).join("") : "";

const tagsFor = (tags) => tags?.map((tag) => ({
  name: tag.name,
  text: typeof tag.text === "string" ? tag.text : displayParts(tag.text)
})) ?? [];

export const diagnosticSeverity = (ts, category) => {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  if (category === ts.DiagnosticCategory.Suggestion) return "hint";
  return "info";
};

const diagnosticMessage = (ts, message) =>
  ts.flattenDiagnosticMessageText(message, "\n");

export const createNormalizers = (ts, project) => {
  const uriForFile = (fileName) => project.uriForFile(fileName) ?? pathToFileURL(fileName).href;

  const location = (entry) => ({
    uri: uriForFile(entry.fileName),
    range: rangeForSpan(entry.textSpan),
    name: entry.name,
    kind: entry.kind,
    containerName: entry.containerName,
    ...(entry.contextSpan === undefined ? {} : { contextRange: rangeForSpan(entry.contextSpan) }),
    ...(entry.isWriteAccess === undefined ? {} : { isWriteAccess: entry.isWriteAccess }),
    ...(entry.isDefinition === undefined ? {} : { isDefinition: entry.isDefinition })
  });

  const relatedDiagnostic = (related) => ({
    uri: related.file ? uriForFile(related.file.fileName) : undefined,
    range: related.start === undefined
      ? undefined
      : { start: related.start, end: related.start + (related.length ?? 0) },
    message: diagnosticMessage(ts, related.messageText)
  });

  const diagnostic = (entry, fallbackFileName) => ({
    uri: entry.file ? uriForFile(entry.file.fileName) : uriForFile(fallbackFileName),
    range: entry.start === undefined
      ? { start: 0, end: 0 }
      : { start: entry.start, end: entry.start + (entry.length ?? 0) },
    code: entry.code,
    severity: diagnosticSeverity(ts, entry.category),
    message: diagnosticMessage(ts, entry.messageText),
    source: "typescript",
    related: entry.relatedInformation?.map(relatedDiagnostic) ?? []
  });

  const textChange = (entry) => ({ range: rangeForSpan(entry.span), text: entry.newText });
  const fileTextChanges = (entry) => ({
    uri: uriForFile(entry.fileName),
    version: project.versionForFile(entry.fileName),
    textChanges: entry.textChanges.map(textChange),
    ...(entry.isNewFile === undefined ? {} : { isNewFile: entry.isNewFile })
  });

  const callItem = (entry) => ({
    name: entry.name,
    kind: entry.kind,
    uri: uriForFile(entry.file),
    range: rangeForSpan(entry.span),
    selectionRange: rangeForSpan(entry.selectionSpan),
    containerName: entry.containerName,
    kindModifiers: entry.kindModifiers
  });

  return {
    uriForFile,
    location,
    diagnostic,
    fileTextChanges,
    callItem,
    completion(result) {
      if (!result) return { items: [], isGlobal: false, isMember: false, isNewIdentifier: false };
      return {
        isGlobal: result.isGlobalCompletion === true,
        isMember: result.isMemberCompletion === true,
        isNewIdentifier: result.isNewIdentifierLocation === true,
        optionalReplacementSpan: rangeForSpan(result.optionalReplacementSpan),
        defaultCommitCharacters: result.defaultCommitCharacters,
        items: result.entries.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          kindModifiers: entry.kindModifiers,
          sortText: entry.sortText,
          insertText: entry.insertText,
          filterText: entry.filterText,
          replacementSpan: rangeForSpan(entry.replacementSpan),
          source: entry.source,
          hasAction: entry.hasAction === true,
          isRecommended: entry.isRecommended === true,
          isSnippet: entry.isSnippet === true,
          commitCharacters: entry.commitCharacters,
          data: entry.data
        }))
      };
    },
    completionDetails(result) {
      if (!result) return undefined;
      return {
        name: result.name,
        kind: result.kind,
        kindModifiers: result.kindModifiers,
        display: displayParts(result.displayParts),
        documentation: displayParts(result.documentation),
        tags: tagsFor(result.tags),
        source: displayParts(result.source),
        codeActions: result.codeActions?.map((action) => ({
          description: action.description,
          commands: action.commands,
          changes: action.changes.map(fileTextChanges)
        })) ?? []
      };
    },
    hover(result) {
      if (!result) return undefined;
      return {
        range: rangeForSpan(result.textSpan),
        kind: result.kind,
        kindModifiers: result.kindModifiers,
        display: displayParts(result.displayParts),
        documentation: displayParts(result.documentation),
        tags: tagsFor(result.tags)
      };
    },
    signature(result) {
      if (!result) return undefined;
      return {
        applicableSpan: rangeForSpan(result.applicableSpan),
        selectedItemIndex: result.selectedItemIndex,
        argumentIndex: result.argumentIndex,
        argumentCount: result.argumentCount,
        items: result.items.map((item) => ({
          isVariadic: item.isVariadic,
          prefix: displayParts(item.prefixDisplayParts),
          separator: displayParts(item.separatorDisplayParts),
          suffix: displayParts(item.suffixDisplayParts),
          documentation: displayParts(item.documentation),
          tags: tagsFor(item.tags),
          parameters: item.parameters.map((parameter) => ({
            name: parameter.name,
            display: displayParts(parameter.displayParts),
            documentation: displayParts(parameter.documentation),
            tags: tagsFor(parameter.tags),
            isOptional: parameter.isOptional === true
          }))
        }))
      };
    },
    locations(result) {
      return result?.map(location) ?? [];
    },
    diagnostics(result, fallbackFileName) {
      return result.map((entry) => diagnostic(entry, fallbackFileName));
    },
    callItems(result) {
      if (!result) return [];
      return (Array.isArray(result) ? result : [result]).map(callItem);
    },
    incomingCalls(result) {
      return result?.map((entry) => ({
        from: callItem(entry.from),
        fromRanges: entry.fromSpans.map(rangeForSpan)
      })) ?? [];
    },
    outgoingCalls(result) {
      return result?.map((entry) => ({
        to: callItem(entry.to),
        fromRanges: entry.fromSpans.map(rangeForSpan)
      })) ?? [];
    },
    renameLocations(result, newName) {
      const grouped = new Map();
      for (const entry of result ?? []) {
        const uri = uriForFile(entry.fileName);
        let group = grouped.get(uri);
        if (!group) {
          group = {
            uri,
            version: project.versionForFile(entry.fileName),
            textChanges: []
          };
          grouped.set(uri, group);
        }
        const prefix = entry.prefixText ?? "";
        const suffix = entry.suffixText ?? "";
        group.textChanges.push({
          range: rangeForSpan(entry.textSpan),
          text: prefix + newName + suffix
        });
      }
      return [...grouped.values()];
    }
  };
};

export const flattenNavigationTree = (tree, uri) => {
  const symbols = [];
  const visit = (item, containerName) => {
    for (const span of item.spans ?? []) {
      symbols.push({
        name: item.text,
        kind: item.kind,
        kindModifiers: item.kindModifiers,
        uri,
        range: rangeForSpan(span),
        selectionRange: rangeForSpan(item.nameSpan ?? span),
        containerName
      });
    }
    for (const child of item.childItems ?? []) visit(child, item.text);
  };
  if (tree) visit(tree, undefined);
  return symbols;
};
