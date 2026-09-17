// Vite serves these as strings; the migrations are the source of truth for the
// schema our tests run against.
declare module "*.sql?raw" {
  const contents: string;
  export default contents;
}
