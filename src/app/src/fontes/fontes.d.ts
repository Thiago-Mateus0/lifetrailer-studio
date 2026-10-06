// O Vite entrega o arquivo como data URL em base64 (`?inline`).
declare module '*.ttf?inline' {
  const dataUrl: string
  export default dataUrl
}
