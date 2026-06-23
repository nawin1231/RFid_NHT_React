import React from "react";
import { shallow } from "enzyme";
import Pallet from "./Pallet";

describe("Pallet", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<Pallet />);
    expect(wrapper).toMatchSnapshot();
  });
});
