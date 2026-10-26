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
    palette: {   // keys = the unicorn's MODEL_SPECS colours (V13 chibi model)
      '#ffffff': '#3a3592', '#fbeefa': '#4d46b0', '#ff8fd0': '#ffd36b', '#fff6fc': '#5a4fc0', '#ffb3df': '#ff8ad8',
      '#ff9ad8': '#ff6ad5', '#f26ac8': '#8795e8', '#ffc2ea': '#7af5ff', '#e455c0': '#c774e8', '#ffb0e2': '#ad8cff',
    },
  },
};

export const LIMITED_IDS = Object.keys(LIMITED_PETS);

/** The Limited entry of a pet (only when it matches the pet's species), else null. */
export function limitedOf(pet) {
  const L = pet && typeof pet.limited === 'string' ? LIMITED_PETS[pet.limited] : null;
  return L && L.speciesId === pet.speciesId ? L : null;
}
