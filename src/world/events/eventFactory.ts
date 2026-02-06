import { WorldEvent } from "../../interfaces/types.js";

export function createEvent(
  eventNumber: number,
  tick: number,
  agentId: string,
  type: string,
  message: string
): WorldEvent {
  return {
    id: `evt_t${tick}_${eventNumber}`,
    at: new Date().toISOString(),
    agentId,
    type,
    message
  };
}
