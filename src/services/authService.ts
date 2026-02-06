import http from "node:http";

export class AuthService {
  constructor(private readonly apiKey: string | undefined) {}

  requiresAuth(): boolean {
    return Boolean(this.apiKey);
  }

  authorize(req: http.IncomingMessage): boolean {
    if (!this.apiKey) {
      return true;
    }

    const incoming = req.headers["x-api-key"];
    if (typeof incoming !== "string") {
      return false;
    }

    return incoming === this.apiKey;
  }
}
