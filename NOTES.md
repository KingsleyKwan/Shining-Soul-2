# Early-game loop — 序章 → 村莊 → 哥不林要塞 → 回城

## Flow

1. **選角**（SelectScene）→ **新遊戲** clears save → StoryScene
2. **序章卡片**（StoryScene）：帝斯哈多擄走卡蜜兒 → 國王馬歇爾委託調查哥不林要塞 → 進入村莊
3. **葛蘭多爾城 lite**（VillageScene）：可行走庭院（WASD／搖桿）+ talk zone（國王／紅鞋少女／北門出發／路牌關卡／南門返回選角）
4. **哥不林要塞**（stage 1）：入口 → 迴廊 → 寶箱 → 蓋利隊長 → 出口（暖綠苔蘚色調 + stage1 BGM）
5. **關卡清除**：主按鈕 **回城** → Village（國王感謝；深層迴廊已解鎖）
6. **深層迴廊**（stage 2）：同結構但冷藍紫霧、更密道具、更硬 Paste + stage2／boss BGM

Continue（已看過序章）→ 直接村莊。Stage 2 可從村莊「關卡選擇」或國王解鎖後進入。

## Save flags（v1）

- `seenIntro` — 序章已看
- `goblinCleared` — 要塞通關（國王 turn-in）
- `villageVisited` — 到過村莊

## Audio（procedural WebAudio）

- BGM tracks: title / village / stage1 / stage2 / boss（場景切換會 stop→start）
- SFX: slash/hit/hurt/door/chest/boss + confirm/pickup/roomClear/bossTelegraph/bossPhase
- Mute：localStorage `shining-soul-2-mute-v1`（M 鍵）

## Soft leftovers vs full GBA

- 無完整王城多層／商店／鬥技場（僅一屏庭院 hub + 對話卡）
- 紅鞋掉落未接（少女僅對話 stub）
- 無像素級原版演出；音效為合成非 ROM 擷取
- Boss 房間 BGM 切換後若中途離開（目前不可）無需還原
