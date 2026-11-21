/**
 * Sharpening-business service vocabulary. Deterministic and versioned: findings and concepts cite
 * the taxonomy version they were produced with. A match means "the site mentions this"; the
 * evidence snippet is always kept so an operator can confirm it.
 */
export const TAXONOMY_VERSION = 'sharpening-taxonomy@2';

export type ServiceCategory = 'knives' | 'tools' | 'specialty' | 'repair' | 'service_model' | 'commercial' | 'retail' | 'education';

export interface ServiceDefinition {
  key: string;
  label: string;
  category: ServiceCategory;
  patterns: RegExp[];
}

export const SERVICES: ServiceDefinition[] = [
  { key: 'kitchen_knives', label: 'Kitchen knife sharpening', category: 'knives', patterns: [/\bkitchen (knife|knives|cutlery)\b/i, /\bchef'?s? (knife|knives)\b/i, /\bculinary (knife|knives)\b/i] },
  { key: 'japanese_knives', label: 'Japanese knives / whetstone sharpening', category: 'knives', patterns: [/\bjapanese (knife|knives|blades?)\b/i, /\b(whet|water) ?stones?\b/i, /\bhand[- ]sharpen(ed|ing)? on (water ?)?stones?\b/i] },
  { key: 'serrated_knives', label: 'Serrated / bread knives', category: 'knives', patterns: [/\bserrated\b/i, /\bbread knife|bread knives\b/i] },
  { key: 'pocket_hunting_knives', label: 'Pocket, hunting & outdoor knives', category: 'knives', patterns: [/\bpocket ?(knife|knives)\b/i, /\bhunting (knife|knives)\b/i, /\b(folding|outdoor|edc) (knife|knives)\b/i] },
  { key: 'scissors', label: 'Scissors & household shears', category: 'tools', patterns: [/\bscissors\b/i, /\b(kitchen|household|fabric|sewing) shears\b/i] },
  { key: 'salon_shears', label: 'Salon, barber & grooming shears', category: 'specialty', patterns: [/\b(hair|salon|beauty|barber|stylist|thinning) (shears|scissors)\b/i] },
  { key: 'pet_grooming', label: 'Pet grooming clipper blades', category: 'specialty', patterns: [/\b(clipper|grooming) blades?\b/i, /\b(pet|dog) grooming\b/i] },
  { key: 'garden_tools', label: 'Garden tools', category: 'tools', patterns: [/\bgarden tools?\b/i, /\b(pruners?|loppers?|secateurs|hedge (shears|trimmers))\b/i] },
  { key: 'mower_blades', label: 'Lawn mower blades', category: 'tools', patterns: [/\b(lawn ?)?mower blades?\b/i, /\blawnmower\b/i] },
  { key: 'axes_machetes', label: 'Axes, hatchets & machetes', category: 'tools', patterns: [/\b(axes|axe|hatchets?|machetes?)\b/i] },
  { key: 'woodworking', label: 'Chisels, plane irons & woodworking tools', category: 'tools', patterns: [/\bchisels?\b/i, /\bplane irons?\b/i, /\b(carving|woodworking) tools?\b/i] },
  { key: 'chainsaw', label: 'Chainsaw chains', category: 'tools', patterns: [/\bchain ?saws?\b/i, /\bsaw chains?\b/i] },
  { key: 'ice_skates', label: 'Ice skates', category: 'specialty', patterns: [/\b(ice|hockey|figure) skates?\b/i, /\bskate sharpening\b/i] },
  { key: 'knife_repair', label: 'Knife repair (chips, tips, reprofiling)', category: 'repair', patterns: [/\bchip(ped)? (repair|removal)\b/i, /\b(broken )?tip repair\b/i, /\bknife repair\b/i, /\bre-?profil(e|ing)\b/i, /\brepair (chipped|broken|damaged)\b/i] },
  { key: 'rehandling', label: 'Rehandling', category: 'repair', patterns: [/\bre-?handl(e|es|ing)\b/i] },
  { key: 'drop_off', label: 'Drop-off', category: 'service_model', patterns: [/\bdrop[- ]?off\b/i, /\bdrop ?box\b/i, /\blockers?\b/i] },
  { key: 'mail_in', label: 'Mail-in service', category: 'service_model', patterns: [/\bmail[- ]in\b/i, /\b(ship|mail|send) (us )?your (knives|blades|tools|scissors)\b/i, /\b(mail|ship|send) (them|it|your \w+) (in|to us)\b/i, /\b(prepaid )?shipping (label|kit|box)\b/i, /\bprepaid label\b/i] },
  { key: 'mobile', label: 'Mobile / on-site sharpening', category: 'service_model', patterns: [/\bmobile (knife )?sharpening\b/i, /\bwe come to you\b/i, /\bon[- ]site sharpening\b/i, /\bsharpening (van|truck|trailer)\b/i] },
  { key: 'farmers_market', label: "Farmers' market sharpening", category: 'service_model', patterns: [/\bfarmers'? markets?\b/i] },
  { key: 'while_you_wait', label: 'While-you-wait service', category: 'service_model', patterns: [/\bwhile you wait\b/i] },
  { key: 'pickup_delivery', label: 'Pickup & delivery', category: 'service_model', patterns: [/\bpick[- ]?up and (delivery|return)\b/i, /\bwe (pick up|collect)\b/i] },
  { key: 'commercial', label: 'Restaurant & commercial accounts', category: 'commercial', patterns: [/\brestaurants?\b/i, /\bcommercial (kitchens?|accounts?|clients?|customers?)\b/i, /\b(food ?service|butchers?|catering|meat (markets?|processors?))\b/i] },
  { key: 'knife_exchange', label: 'Knife exchange / rental program', category: 'commercial', patterns: [/\bknife (exchange|rental|swap)\b/i, /\bexchange (program|service)\b/i] },
  { key: 'retail', label: 'Knife & sharpening product sales', category: 'retail', patterns: [/\bknife sales\b/i, /\bwe (sell|carry) (knives|whetstones|sharpeners|stones)\b/i] },
  { key: 'gift_cards', label: 'Gift cards', category: 'retail', patterns: [/\bgift (cards?|certificates?)\b/i] },
  { key: 'classes', label: 'Sharpening classes', category: 'education', patterns: [/\bsharpening (class|classes|lessons?|workshops?)\b/i, /\blearn (how )?to sharpen\b/i] },
];
