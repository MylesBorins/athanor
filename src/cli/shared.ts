import { style, sym } from "./style.js"

export function ok(msg: string): void   { console.log(`${style.green(sym.check)} ${msg}`) }
export function info(msg: string): void { console.log(`${style.cyan(sym.arrow)} ${msg}`) }
export function warn(msg: string): void { console.log(`${style.yellow(sym.warn)} ${msg}`) }
export function head(msg: string): void { console.log(style.bold(msg)) }
export function dim(msg: string): string { return style.gray(msg) }
