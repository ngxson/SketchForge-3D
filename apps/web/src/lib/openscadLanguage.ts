import { StreamLanguage, type StreamParser } from "@codemirror/language";

const KEYWORDS = new Set(["module", "function", "if", "else", "for", "let", "each", "intersection_for", "include", "use", "assert", "echo"]);
const CONSTANTS = new Set(["true", "false", "undef", "PI"]);
const BUILTINS = new Set([
  "cube", "sphere", "cylinder", "polyhedron", "square", "circle", "polygon", "text", "import", "surface",
  "translate", "rotate", "scale", "resize", "mirror", "multmatrix", "color", "offset", "hull", "minkowski",
  "union", "difference", "intersection", "linear_extrude", "rotate_extrude", "projection", "render", "children",
  "abs", "sign", "sin", "cos", "tan", "acos", "asin", "atan", "atan2", "floor", "round", "ceil", "ln", "len", "log",
  "pow", "sqrt", "exp", "rands", "min", "max", "concat", "lookup", "str", "chr", "ord", "search", "version",
  "version_num", "norm", "cross", "parent_module", "is_undef", "is_list", "is_num", "is_bool", "is_string",
]);

type State = { inBlockComment: boolean };

const parser: StreamParser<State> = {
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|^\.\d+(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^\$[A-Za-z_]\w*/)) return "variableName.special";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) return "keyword";
      if (CONSTANTS.has(word)) return "atom";
      if (BUILTINS.has(word)) return "variableName.function";
      return "variableName";
    }
    if (stream.match(/^[-+*\/%=<>!&|?:#]+/)) return "operator";
    if (stream.match(/^[{}()\[\],;]/)) return "punctuation";
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
};

export const openScadLanguage = StreamLanguage.define(parser);
