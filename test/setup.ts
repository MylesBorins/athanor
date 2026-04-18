import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-test-"))
process.env.ATHANOR_HOME = path.join(root, "athanor")
process.env.PI_HOME = path.join(root, "pi")
fs.mkdirSync(process.env.ATHANOR_HOME, { recursive: true })
fs.mkdirSync(process.env.PI_HOME, { recursive: true })
