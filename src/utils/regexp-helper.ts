export function escape(value: string): string {
  return value.replace(/\W/g, (x) => {
    return `\\${x}`
  })
}
