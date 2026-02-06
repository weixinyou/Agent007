import { AgentState, LocationId } from "../interfaces/types.js";

export class AgentRegistry {
  create(agentId: string, walletAddress: string, startLocation: LocationId = "town"): AgentState {
    return {
      id: agentId,
      walletAddress,
      enteredAt: new Date().toISOString(),
      location: startLocation,
      energy: 10,
      inventory: {},
      reputation: 0
    };
  }
}
