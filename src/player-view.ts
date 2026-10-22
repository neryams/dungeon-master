import { partyState } from './domain.js';
import { State, CampaignConfig } from './schema.js';
import { characterSheet, partyOverview } from './sheets.js';

// Shared by the read-only web panel and desktop. Never return the original snapshot.
export function playerView(original: State, config: CampaignConfig) {
  const state = partyState(original);
  const overview = partyOverview(state);
  const active = original.encounter?.participants[original.encounter.turn]?.id;
  return {
    campaign: { id: config.id, name: config.name },
    revision: state.revision,
    party: overview,
    sheets: overview.members.map((m) => characterSheet(state, m.id)),
    focus: state.focus,
    scene: state.scene,
    quests: Object.values(state.entities).filter((e) => e.quest?.status === 'active'),
    maps: Object.values(state.entities)
      .filter((e) => e.map)
      .map((e) => ({ id: e.id, name: e.name, kind: e.map!.kind, bounds: e.map!.bounds })),
    encounter: state.encounter
      ? {
          round: state.encounter.round,
          activeId: active && state.entities[active] ? active : null,
          participants: state.encounter.participants.map((p) => ({
            ...p,
            name: state.entities[p.id].name,
          })),
        }
      : null,
  };
}
