// O Vite entrega a imagem como data URL em base64 (`?inline`).
declare module '*.png?inline' {
  const dataUrl: string
  export default dataUrl
}
