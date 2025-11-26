Author Inventory — Future Enhancements

1. **Multi-User Support**
   - Add author/team management so each Cognito user can invite assistants.
   - Introduce role-based access (read-only reports vs. full inventory control).

2. **Advanced Reporting**
   - Export CSV summaries per event and per-title.
   - Add configurable restock thresholds + notifications (SNS/email).

3. **Testing & Tooling**
   - Add Jest unit tests for `InventoryStoreService` and component specs for the new pages.
   - Wire linting (`ng lint`) + formatting into the CI workflow before deploy.

4. **Performance polish**
   - Prefetch next routes (show mode / reports) via Angular’s router preloading once the user authenticates.
   - Add skeleton states for book/event lists during sync to improve perceived responsiveness.
