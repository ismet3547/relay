export class DemoError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}
export class FlowCancelled extends Error {}
