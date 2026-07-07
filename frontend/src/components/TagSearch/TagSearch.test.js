import React from "react";
import { shallow } from "enzyme";
import TagSearch from "./TagSearch";

describe("TagSearch", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<TagSearch />);
    expect(wrapper).toMatchSnapshot();
  });
});
