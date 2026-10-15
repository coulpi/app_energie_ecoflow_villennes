// Rattachement des appareils au réseau 2 (compteur EDF séparé de la maison) :
// piscine, jacuzzi et prises / bornes de recharge de voiture électrique.
// Testé sur le nom de l'appareil ou du profil de charge (id + nom).

const NETWORK2_RE = /piscine|jacuzzi|\bspa\b|pool|voiture|borne|\bve\b|\bev\b|lp_ev/i;

export const isNetwork2 = (nameOrId: string): boolean => NETWORK2_RE.test(nameOrId);

/** Usages du réseau 2, pour les libellés. */
export const NETWORK2_USES = "piscine, jacuzzi, voiture";
