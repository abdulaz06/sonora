declare module '*.vert?raw' {
  const source: string;
  export default source;
}

declare module '*.frag?raw' {
  const source: string;
  export default source;
}

declare module '*.glsl?raw' {
  const source: string;
  export default source;
}

declare module '*?url' {
  const url: string;
  export default url;
}
