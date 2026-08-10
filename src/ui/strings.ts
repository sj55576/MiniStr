/**
 * Japanese UI resources. Keeping user-facing copy in one module is the first
 * i18n boundary: a future locale can provide the same keys without changing
 * game rules or DOM event handling.
 */
export const uiText = {
  defaultInstruction: 'ユニットを選択して行動してください。',
  saveManager: 'セーブ管理',
  saveSlot: '新しいセーブ',
  storageUsage: '保存領域',
  storageWarning: '保存領域が大きくなっています。不要なセーブやカスタムマップを削除してください。',
} as const;

const commandErrorMessages: Record<string, string> = {
  'Game has finished': '対局は終了しています。',
  'Unit not found': '対象のユニットが見つかりません。',
  'Embarked units cannot move': '乗船中のユニットは移動できません。',
  'Embarked units cannot wait': '乗船中のユニットは待機できません。',
  'Unit belongs to the other player': '相手軍のユニットは操作できません。',
  'Unit has already moved': 'このユニットはすでに移動済みです。',
  'Unit has already acted': 'このユニットはすでに行動済みです。',
  'Unit is out of fuel': '燃料切れのため移動できません。',
  'Destination is occupied': 'そのマスにはユニットがいます。',
  'Destination is out of range': 'そのマスは移動範囲外です。',
  'An owned compatible production facility is required': '対応する自軍の生産施設を選んでください。',
  'Production facility is occupied': '生産施設がユニットで埋まっています。',
  'Insufficient funds': '資金が不足しています。',
  'An active player unit is required': '自軍の盤上ユニットを選んでください。',
  'No enemy property to capture': 'ここは占領できる敵軍または中立の拠点ではありません。',
  'Unit cannot capture': 'このユニットは占領できません。',
  'Unit cannot attack': 'このユニットは攻撃できません。',
  'Indirect units cannot attack after moving': '間接砲は移動したターンに攻撃できません。',
  'Unit is out of ammunition': '弾薬切れのため攻撃できません。',
  'Target is not visible': '未索敵の敵ユニットは攻撃できません。',
  'A deployed embarkable unit and transport are required': '盤上の搭載可能ユニットと輸送部隊を選んでください。',
  'An active player transport is required': '自軍の輸送部隊を選んでください。',
  'This unit cannot embark': 'このユニットは搭載できません。',
  'A transport unit is required': '輸送部隊を選んでください。',
  'Unit or transport has already acted': 'ユニットまたは輸送部隊はすでに行動済みです。',
  'Unit must embark from an adjacent traversable tile': 'ユニットは隣接する進入可能なマスから搭載してください。',
  'Transport is already at capacity': '輸送部隊は満載です。',
  'A deployed transport unit is required': '盤上の輸送部隊を選んでください。',
  'Transport has already acted': '輸送部隊はすでに行動済みです。',
  'Transport has no valid cargo': '輸送部隊に降車できる搭載ユニットがありません。',
  'Destination must be an adjacent vacant land tile': '降車先は隣接する空の陸地を選んでください。',
};

export function commandErrorMessage(error: string): string {
  return commandErrorMessages[error] ?? 'この操作は実行できませんでした。';
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}
