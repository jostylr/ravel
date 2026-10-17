// Turn straight double quotes in text (not inside HTML tags) into curly ones.
// Rendered Markdown spells them `&quot;`, so both forms are handled.
export default (value) => value.replace(/(^|>)([^<]*)/g, (match, open, text) =>
  open + text.replace(/(?:"|&quot;)([^"<]*?)(?:"|&quot;)/g, "“$1”"));
