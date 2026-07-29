# AI 스테이지 렌더러

NEON RUMBLE은 AI 이미지와 Canvas 전투 렌더링을 제한적으로 결합합니다.

## 적용 범위

AI 이미지는 다음 두 영역에만 사용합니다.

- Neon Deck, Sky Rail, Reactor Core 배경
- 각 스테이지의 바닥, 절벽, 통과 발판, 이동 발판

캐릭터, HUD 초상화, 투사체, 공격·피격·필살기·궁극기 이펙트는 기존 Canvas 렌더러를 사용합니다. 작은 전투 요소는 정확한 실루엣, 관절 연결, 히트박스 정렬과 프레임 일관성이 이미지 디테일보다 중요하기 때문입니다.

## 렌더링 원칙

- 배경 이미지는 충돌 판정에 관여하지 않습니다.
- 지형 이미지는 서버가 제공하는 실제 충돌 좌표에 맞춰 늘려 그립니다.
- 이미지가 아직 로드되지 않았거나 로드에 실패하면 기존 Canvas 배경과 지형으로 즉시 대체됩니다.
- `?art=legacy`를 주소 뒤에 붙이면 모든 스테이지 이미지를 끄고 기존 Canvas 화면을 비교할 수 있습니다.

## 파일 구조

```text
assets/prototype/
├─ neon-deck/
│  ├─ background.png
│  └─ terrain/
├─ sky-rail/
│  ├─ background.png
│  └─ terrain/
└─ reactor-core/
   ├─ background.png
   └─ terrain/
```

에셋 목록과 용도는 `assets/prototype/manifest.json`에 기록합니다. `art-assets.js`는 배경과 지형만 로드하며 전투 에셋 API는 의도적으로 비활성화되어 있습니다.
