// V12 Limited pets: one-off gift versions of a species (pet.limited = id). Pure data, no imports.
// palette: { '#from': '#to' } over the species' MODEL_SPECS colours (replaces its shinyPalette); aura.colors: walked by the 3D aura.

export const LIMITED_PETS = {
  celestial: {
    id: 'celestial',
    speciesId: 'unicorn',
    nameTh: 'ยูนิคอร์นดาราจักร',
    nickname: 'ดาราจักร',
    personality: 'cheerful',
    stage: 1,
    icon: '🌌',
    badge: 'Limited',
    desc: 'ขนสีห้วงอวกาศ แผงคอเป็นทางช้างเผือก มีให้เฉพาะผู้มาเยือนฟาร์มรุ่นแรกเท่านั้น',
    aura: { colors: ['#ff6ad5', '#c774e8', '#8795e8', '#7af5ff', '#94ffd8', '#ffe27a'] },
    palette: {
      '#fff7fb': '#2e2a78', '#f3e8f8': '#3b3590', '#e9b830': '#ffd36b', '#ffe3ee': '#4d40a8', '#ffc0d8': '#ff8ad8',
      '#fff1b8': '#fffbe6', '#ffc83a': '#ffe27a',
      '#ff7aa8': '#ff6ad5', '#ffb35c': '#c774e8', '#ffe66d': '#ad8cff', '#7be0a0': '#8795e8', '#6ab7ff': '#94d0ff', '#b58cff': '#7af5ff',
    },
  },
};

export const LIMITED_IDS = Object.keys(LIMITED_PETS);

/** The Limited entry of a pet (only when it matches the pet's species), else null. */
export function limitedOf(pet) {
  const L = pet && typeof pet.limited === 'string' ? LIMITED_PETS[pet.limited] : null;
  return L && L.speciesId === pet.speciesId ? L : null;
}
