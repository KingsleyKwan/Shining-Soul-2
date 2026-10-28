# Early-game loop — 序章 → 村莊 → 哥不林要塞 → 回城

## Flow

1. **選角**（SelectScene）→ **新遊戲** clears save → StoryScene
2. **序章卡片**（StoryScene）：帝斯哈多擄走卡蜜兒 → 國王馬歇爾委託調查哥不林要塞 → 進入村莊
3. **葛蘭多爾城 lite**（VillageScene）：國王（任務／回報）、紅鞋少女 stub、出發要塞、關卡選擇
4. **哥不林要塞**（stage 1）：入口 → 迴廊 → 寶箱 → 蓋利隊長 → 出口
5. **關卡清除**：主按鈕 **回城** → Village（國王感謝；深層迴廊已解鎖）

Continue（已看過序章）→ 直接村莊。Stage 2「深層迴廊」仍可從村莊「關卡選擇」進入。

## Save flags（v1）

- `seenIntro` — 序章已看
- `goblinCleared` — 要塞通關（國王 turn-in）
- `villageVisited` — 到過村莊

## Soft leftovers vs full GBA

- 無完整王城地圖／商店／鬥技場實戰（僅對話卡）
- 紅鞋掉落未接（少女僅對話 stub）
- 無像素級原版演出
