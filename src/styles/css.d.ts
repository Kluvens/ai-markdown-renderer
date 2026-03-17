/** tsup loads .css files as plain text strings via `loader: { '.css': 'text' }` */
declare module '*.css' {
  const content: string;
  export default content;
}
