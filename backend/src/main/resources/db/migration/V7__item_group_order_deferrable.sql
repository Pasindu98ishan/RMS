-- BUG-1-007: reordering the modifier groups of an item (e.g. [G1, G2] -> [G2, G1]) updates the join rows in place,
-- one position at a time, so for a moment two rows of the item hold the same group and the unique key
-- (menu_item_id, modifier_group_id) was violated (409 "conflicting data"). The key is checked at commit instead:
-- it still guarantees a group is attached to an item at most once, but a reorder inside one transaction works.
ALTER TABLE menu_item_modifier_group DROP CONSTRAINT IF EXISTS menu_item_modifier_group_menu_item_id_modifier_group_id_key;
ALTER TABLE menu_item_modifier_group
    ADD CONSTRAINT ux_menu_item_modifier_group UNIQUE (menu_item_id, modifier_group_id) DEFERRABLE INITIALLY DEFERRED;
