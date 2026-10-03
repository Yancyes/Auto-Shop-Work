<template>
  <div class="page-skeleton">
    <div class="skeleton-block skeleton-title" />

    <div class="skeleton-cards">
      <div v-for="row in 3" :key="row" class="skeleton-card">
        <div class="skeleton-block card-thumb" />
        <div class="card-lines">
          <div class="skeleton-block line w60" />
          <div class="skeleton-block line w90" />
          <div class="skeleton-block line w40" />
        </div>
      </div>
    </div>

    <div class="skeleton-rows">
      <div v-for="row in 4" :key="row" class="skeleton-block row" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.page-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* 骨架屏只在真正卡住时才值得被看见：前 0.12s 保持透明，
     本地秒开的场景下整段动画来不及露出，不会出现闪一下的白块 */
  animation: skeleton-appear 0.2s ease 0.12s backwards;
}

.skeleton-block {
  border-radius: 8px;
  background: linear-gradient(90deg, #f2f3f7 25%, #e6e8ef 37%, #f2f3f7 63%);
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
}

.skeleton-title {
  width: 200px;
  height: 28px;
}

.skeleton-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.skeleton-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #fff;

  .card-thumb {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
  }

  .card-lines {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 4px;
  }

  .line {
    height: 12px;
  }
}

.w40 { width: 40%; }
.w60 { width: 60%; }
.w90 { width: 90%; }

.skeleton-rows .row {
  height: 40px;
}

@keyframes skeleton-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@keyframes skeleton-appear {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .page-skeleton {
    animation: none;
  }

  .skeleton-block {
    animation: none;
  }
}
</style>
