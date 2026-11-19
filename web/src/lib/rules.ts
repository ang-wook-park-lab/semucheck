// 체크리스트의 risk_rule / applies_if 식을 안전하게 평가하는 작은 해석기.
// eval()을 쓰지 않는다. 지원 문법: ==, !=, >, >=, <, <=, in [..], and, or, not, 괄호, 문자열·숫자·true/false(True/False).
// 값이 없는(undefined) 변수가 끼면 결과는 null(알 수 없음)이다.

export type Value = string | number | boolean | null | undefined | Value[]
export type Env = Record<string, Value>

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const OPS = ['==', '!=', '>=', '<=', '>', '<', '(', ')', '[', ']', ',']

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1)
      if (end < 0) throw new Error(`문자열이 닫히지 않았습니다: ${src}`)
      out.push({ t: 'str', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i))
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue }
    throw new Error(`해석할 수 없는 문자 '${c}': ${src}`)
  }
  return out
}

type Tri = boolean | null

class Parser {
  private p = 0
  constructor(private toks: Token[], private env: Env, private src: string) {}

  parse(): Tri {
    const v = this.or()
    if (this.p < this.toks.length) throw new Error(`식 끝에 남는 내용이 있습니다: ${this.src}`)
    return v
  }

  private peekId(name: string) {
    const t = this.toks[this.p]
    return t && t.t === 'id' && t.v === name
  }
  private peekOp(op: string) {
    const t = this.toks[this.p]
    return t && t.t === 'op' && t.v === op
  }

  private or(): Tri {
    let v = this.and()
    while (this.peekId('or')) {
      this.p++
      const r = this.and()
      v = v === true || r === true ? true : v === null || r === null ? null : false
    }
    return v
  }
  private and(): Tri {
    let v = this.not()
    while (this.peekId('and')) {
      this.p++
      const r = this.not()
      v = v === false || r === false ? false : v === null || r === null ? null : true
    }
    return v
  }
  private not(): Tri {
    if (this.peekId('not')) {
      this.p++
      const v = this.not()
      return v === null ? null : !v
    }
    return this.cmp()
  }

  private cmp(): Tri {
    const left = this.primary()
    const t = this.toks[this.p]
    if (t && t.t === 'id' && t.v === 'in') {
      this.p++
      const list = this.primary()
      if (!Array.isArray(list)) throw new Error(`in 뒤에는 목록이 필요합니다: ${this.src}`)
      if (left === undefined || left === null) return null
      return list.some((x) => x === left)
    }
    if (t && t.t === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.v)) {
      this.p++
      const right = this.primary()
      if (left === undefined || left === null || right === undefined || right === null) return null
      switch (t.v) {
        case '==': return left === right
        case '!=': return left !== right
        default: {
          if (typeof left !== 'number' || typeof right !== 'number') return null
          if (t.v === '>') return left > right
          if (t.v === '>=') return left >= right
          if (t.v === '<') return left < right
          return left <= right
        }
      }
    }
    if (typeof left === 'boolean') return left
    if (left === undefined || left === null) return null
    throw new Error(`비교 연산자가 없는 식입니다: ${this.src}`)
  }

  private primary(): Value {
    const t = this.toks[this.p]
    if (!t) throw new Error(`식이 중간에 끝났습니다: ${this.src}`)
    this.p++
    if (t.t === 'num' || t.t === 'str') return t.v
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'True') return true
      if (t.v === 'false' || t.v === 'False') return false
      return this.env[t.v]
    }
    if (t.v === '(') {
      const v = this.or()
      if (!this.peekOp(')')) throw new Error(`')'가 필요합니다: ${this.src}`)
      this.p++
      return v
    }
    if (t.v === '[') {
      const list: Value[] = []
      while (!this.peekOp(']')) {
        list.push(this.primary())
        if (this.peekOp(',')) this.p++
        else if (!this.peekOp(']')) throw new Error(`목록 구문 오류: ${this.src}`)
      }
      this.p++
      return list
    }
    throw new Error(`예상하지 못한 '${t.v}': ${this.src}`)
  }
}

/** 식을 평가한다. true/false, 값이 모자라 판단할 수 없으면 null. 문법 오류는 예외. */
export function evalExpr(src: string, env: Env): boolean | null {
  return new Parser(tokenize(src), env, src).parse()
}

/** 위험 판정. 'False'는 정보 수집용(항상 위험 아님). 답이 없으면 null. */
export function isRisk(riskRule: string, answer: string | number | undefined): boolean | null {
  const rule = riskRule.trim()
  if (rule === 'False') return false
  if (answer === undefined || answer === '') return null
  return evalExpr(rule, { answer })
}
