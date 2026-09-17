/**
 * Which material families a craft works in.
 *
 * Split out of src/lib/suppliers.ts so a client component (the learning
 * catalogue, which must render offline) can match a craft without bundling the
 * whole supplier directory. suppliers.ts re-exports both names, so existing
 * imports are unchanged.
 */

/** A material family, i.e. the thing an artisan buys rather than the craft. */
export type MaterialFamily =
  | 'silk-yarn'
  | 'cotton-yarn'
  | 'natural-dye'
  | 'brass-bell-metal'
  | 'silver-inlay'
  | 'clay-quartz-glaze'
  | 'mirror-thread'
  | 'stone-pigment'
  | 'lac-wood'
  | 'pashmina-wool'
  | 'palm-leaf-paper';

/**
 * An artisan's `craftType` -> the material families they buy.
 *
 * Ordered: the first family is the craft's primary input, and the route keeps
 * that order so a Sambalpuri weaver is offered silk before dye and dye before
 * anything else. A craft that matches nothing falls back to the broad textile
 * and pigment families rather than to an empty list, because an artisan whose
 * craft we do not recognise is still better served by a plausible list than by
 * a blank tab.
 */
export function familiesForCraft(craftType: string): MaterialFamily[] {
  const craft = (craftType || '').toLowerCase();

  const rules: [RegExp, MaterialFamily[]][] = [
    [/pashmina|shahtoosh|sozni|kani |cashmere|namda/, ['pashmina-wool', 'mirror-thread', 'natural-dye']],
    [/bidri|bidar ware|bidriware/, ['brass-bell-metal', 'silver-inlay']],
    [/meenakari|enamel|filigree|tarakasi/, ['silver-inlay', 'brass-bell-metal']],
    [/dhokra|dokra|bell metal|kansa|brass|bronze|metal ?craft|pembarthi/, ['brass-bell-metal', 'clay-quartz-glaze']],
    [/channapatna|kondapalli|etikoppaka|lacquer|lacquerware|wooden toy|toy/, ['lac-wood', 'natural-dye']],
    [/blue pottery|pottery|terracotta|ceramic|clay|molela|panchmura|kumhar/, ['clay-quartz-glaze', 'stone-pigment']],
    [/pattachitra|patachitra|palm leaf|talapatra|ganjapa/, ['stone-pigment', 'palm-leaf-paper', 'silk-yarn']],
    [/madhubani|mithila|warli|gond|tanjore|thanjavur|kalighat|phad|pichwai|cheriyal|miniature|painting|folk art/, ['stone-pigment', 'palm-leaf-paper']],
    [/kalamkari|ajrakh|bagh|bagru|dabu|block print|batik/, ['natural-dye', 'cotton-yarn']],
    [/kutch|rabari|abhla|mirror|phulkari|chikan|kantha|zardozi|embroider|applique|toran/, ['mirror-thread', 'cotton-yarn', 'natural-dye']],
    [/kanjivaram|kanchipuram|banarasi|paithani|patola|silk|pata |muga|tussar/, ['silk-yarn', 'natural-dye', 'cotton-yarn']],
    [/ikat|bandha|sambalpuri|pochampally|saree|sari|handloom|weav|dupatta|stole|yardage|khadi|chanderi|cotton/, ['cotton-yarn', 'silk-yarn', 'natural-dye']],
    [/bamboo|cane|wicker|basket|leather|jutti|mojari|stone|marble|wood|carv/, ['lac-wood', 'natural-dye']],
  ];

  for (const [pattern, families] of rules) {
    if (pattern.test(craft)) return families;
  }
  return ['cotton-yarn', 'natural-dye', 'stone-pigment'];
}
